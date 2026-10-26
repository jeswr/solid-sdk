// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  type AnchorResult,
  createSelectors,
  reanchor,
  type TextSelectors,
} from "../src/apps/docs/lib/anchoring";

function selection(text: string, quote: string): TextSelectors {
  const start = Array.from(text.slice(0, text.indexOf(quote))).length;
  return createSelectors(text, { start, end: start + Array.from(quote).length });
}

function attached(result: AnchorResult) {
  expect(result.status).toBe("anchored");
  if (result.status !== "anchored") throw new Error("Expected an anchored result");
  return result;
}

describe("Web Annotation selectors", () => {
  it("creates quote, 32-code-point context and a position from a non-empty selection", () => {
    const prefix = "🌱".repeat(40);
    const suffix = "🪴".repeat(40);
    const selectors = createSelectors(`${prefix}Mira's plan${suffix}`, { start: 40, end: 51 });
    expect(selectors).toEqual({
      quote: {
        type: "TextQuoteSelector",
        exact: "Mira's plan",
        prefix: "🌱".repeat(32),
        suffix: "🪴".repeat(32),
      },
      position: { type: "TextPositionSelector", start: 40, end: 51 },
    });
  });

  it("clips context at document boundaries and permits the whole document", () => {
    expect(createSelectors("abc", { start: 0, end: 3 }).quote).toEqual({
      type: "TextQuoteSelector",
      exact: "abc",
      prefix: "",
      suffix: "",
    });
    expect(createSelectors("abc", { start: 0, end: 1 }).quote.suffix).toBe("bc");
    expect(createSelectors("abc", { start: 2, end: 3 }).quote.prefix).toBe("ab");
  });

  it("preserves line breaks, whitespace, combining marks, bidi and non-BMP characters", () => {
    const text = "🌱e\u0301  \r\nשלום <plan>\t🪴";
    const points = Array.from(text);
    const anchor = createSelectors(text, { start: 1, end: points.length - 1 });
    expect(anchor.quote.exact).toBe("e\u0301  \r\nשלום <plan>\t");
    expect(attached(reanchor(text, anchor)).range).toEqual({ start: 1, end: points.length - 1 });
  });

  it.each([
    [-1, 1],
    [0, 0],
    [2, 1],
    [0.5, 2],
    [0, 1.5],
    [NaN, 1],
    [0, Infinity],
    [0, Number.MAX_SAFE_INTEGER + 1],
    [0, 4],
  ])("rejects invalid or out-of-bounds range %s..%s", (start, end) => {
    expect(() => createSelectors("abc", { start, end })).toThrow(RangeError);
  });
  it("rejects a selection in empty text", () => {
    expect(() => createSelectors("", { start: 0, end: 1 })).toThrow(RangeError);
  });
});

describe("re-anchoring", () => {
  it("checks position first even when context changes and duplicate text exists", () => {
    const anchor = selection("a plan b", "plan");
    const result = attached(reanchor("z plan c plan", anchor));
    expect(result.method).toBe("position");
    expect(result.confidence).toBe(1);
    expect(result.selectors.quote).toEqual({
      type: "TextQuoteSelector",
      exact: "plan",
      prefix: "z ",
      suffix: " c plan",
    });
  });

  it("finds quotes anywhere after large insertions, independently of fuzzy bounds", () => {
    const result = attached(
      reanchor(`${"x".repeat(5000)}🌱plan`, selection("plan", "plan"), {
        searchRadius: 0,
        maxEdits: 0,
      }),
    );
    expect(result.method).toBe("quote");
    expect(result.range).toEqual({ start: 5001, end: 5005 });
  });

  it("finds a moved quote when its original range is beyond the new document", () => {
    const result = attached(reanchor("plan", selection("a long introduction plan", "plan")));
    expect(result.method).toBe("quote");
    expect(result.range).toEqual({ start: 0, end: 4 });
  });

  it("uses prefix and suffix to choose among duplicate quotes before proximity", () => {
    const anchor = selection("Mira: plan approved.", "plan");
    const text = "Another plan rejected. A long intro. Mira: plan approved.";
    expect(attached(reanchor(text, anchor)).range.start).toBe(text.lastIndexOf("plan"));
    const suffixOnly = selection("plan approved.", "plan");
    expect(attached(reanchor("x plan rejected; plan approved.", suffixOnly)).range.start).toBe(17);
  });

  it("uses proximity then earliest start for ties, including overlapping quotes", () => {
    const anchor = selection("12345aba", "aba");
    expect(attached(reanchor("aba......aba", anchor)).range.start).toBe(9);
    const tie = selection("12aba", "aba");
    expect(attached(reanchor("abacaba", tie)).range.start).toBe(0);
    const overlapping = selection("12345aaa", "aaa");
    expect(attached(reanchor("aaaa", overlapping)).range.start).toBe(1);
  });

  it.each([
    ["the garden plan", "the gxrden plan", 1],
    ["the garden plan", "the garXden plan", 1],
    ["the garden plan", "the gaden plan", 1],
    ["the garden plan", "the grden pln", 2],
    ["the garden plan", "the gardne plan", 2],
  ])("fuzzy matches substitutions, insertions, deletions and transpositions: %s → %s", (before, after, edits) => {
    const anchor = selection(`Mira: ${before}.`, before);
    const result = attached(reanchor(`Mira: ${after}.`, anchor));
    expect(result.method).toBe("fuzzy");
    expect(result.range).toEqual({ start: 6, end: 6 + after.length });
    expect(result.confidence).toBeCloseTo(1 - edits / before.length);
    expect(result.selectors.quote.exact).toBe(after);
  });

  it("compares fuzzy candidates by edit count first, then context", () => {
    const anchor = selection("Mira: garden plan!", "garden plan");
    const text = "x gxrden plan? Mira: gardxn plan!";
    expect(attached(reanchor(text, anchor)).range.start).toBe(text.indexOf("gardxn"));
    const better = "Mira: gxrdxn plan! Else: gxrden plan!";
    expect(attached(reanchor(better, anchor)).range.start).toBe(better.lastIndexOf("gxrden"));
  });

  it("accepts confidence exactly at threshold and orphans below it", () => {
    const anchor = createSelectors("abcd", { start: 0, end: 4 });
    const result = attached(reanchor("abXY", anchor));
    expect(result.confidence).toBe(0.5);
    expect(reanchor("abXY", anchor, { threshold: 0.51 })).toEqual({
      status: "orphan",
      confidence: 0.5,
    });
    expect(reanchor("abXY", anchor, { threshold: 1 })).toEqual({
      status: "orphan",
      confidence: 0.5,
    });
    expect(reanchor("abXY", anchor, { threshold: 0 })).toHaveProperty("status", "anchored");
  });

  it("orphans unrelated, deleted and empty text without returning a range", () => {
    const anchor = selection("garden plan", "garden plan");
    for (const text of ["ZZZZZZZZZZZ", "", "☀☀☀"]) {
      expect(reanchor(text, anchor)).toEqual({ status: "orphan", confidence: 0 });
    }
    expect(reanchor("b", selection("a", "a"))).toEqual({ status: "orphan", confidence: 0 });
  });

  it("bounds fuzzy starts, accepts the boundary and can use a clamped stale position", () => {
    const anchor = selection("abcd", "abcd");
    expect(reanchor("ZZZZabXd", anchor, { searchRadius: 3, maxEdits: 1 })).toEqual({
      status: "orphan",
      confidence: 0,
    });
    expect(attached(reanchor("ZZZZabXd", anchor, { searchRadius: 4, maxEdits: 1 })).range).toEqual({
      start: 4,
      end: 8,
    });
    expect(attached(reanchor("abXd", selection("ZZZZZZabcd", "abcd"))).range).toEqual({
      start: 0,
      end: 4,
    });
    expect(reanchor("abXd", anchor, { maxEdits: 0 })).toEqual({ status: "orphan", confidence: 0 });
  });

  it("searches both sides of the old position and allows a zero-radius fuzzy edit", () => {
    const anchor = selection("ZZZZabcd", "abcd");
    expect(attached(reanchor("abXd", anchor, { searchRadius: 4 })).range.start).toBe(0);
    expect(attached(reanchor("ZZZZabXd", anchor, { searchRadius: 0 })).range.start).toBe(4);
  });

  it.each([
    31, 32, 33, 64, 65, 100,
  ])("matches an entire %i-code-point pattern across word boundaries", (length) => {
    const pattern = Array.from({ length }, (_, i) => String.fromCodePoint(0x400 + i)).join("");
    const changed = Array.from(pattern);
    changed[Math.min(31, length - 2)] = "🌱";
    changed.splice(Math.min(64, length - 2), 0, "🪴");
    const text = `new ${changed.join("")} end`;
    const result = attached(reanchor(text, selection(`new ${pattern} end`, pattern)));
    expect(result.range).toEqual({ start: 4, end: 4 + length + 1 });
    expect(result.confidence).toBeCloseTo(1 - 2 / length);
    expect(result.selectors.quote.exact).toBe(changed.join(""));
  });

  it("does not accept a long quote from matching outer chunks alone", () => {
    const original = `${"a".repeat(32)}${"b".repeat(100)}${"c".repeat(32)}`;
    const changed = original.replaceAll("b", "Z");
    expect(reanchor(changed, selection(original, original))).toEqual({
      status: "orphan",
      confidence: 0,
    });
  });

  it("supports 32 edits without JavaScript shift-count wraparound", () => {
    const original = `${"a".repeat(32)}${"b".repeat(32)}`;
    const result = attached(reanchor("b".repeat(32), selection(original, original)));
    expect(result.confidence).toBe(0.5);
    expect(result.range).toEqual({ start: 0, end: 32 });
  });

  it("follows an edit sequence, refreshes selectors and retains immutable input snapshots", () => {
    let text = "Mira's notes:\nThe garden plan is ready.\nReview tomorrow.";
    let anchor = selection(text, "garden plan");
    for (const [next, method, quote] of [
      [text, "position", "garden plan"],
      [`Intro.\n${text}`, "quote", "garden plan"],
      [`Intro.\n${text}`.replace("garden plan", "garden plans"), "position", "garden plan"],
      [`Intro.\n${text}`.replace("garden plan", "gardxn plan"), "fuzzy", "gardxn plan"],
      [text.replace("garden plan", "gardxn plan"), "quote", "gardxn plan"],
    ] as const) {
      Object.freeze(anchor.quote);
      Object.freeze(anchor.position);
      Object.freeze(anchor);
      const snapshot = JSON.stringify(anchor);
      const result = attached(reanchor(next, anchor));
      expect(result.method).toBe(method);
      expect(result.selectors.quote.exact).toBe(quote);
      expect(JSON.stringify(anchor)).toBe(snapshot);
      expect(result.selectors).not.toBe(anchor);
      anchor = result.selectors;
      text = next;
    }
    expect(reanchor("Everything was removed.", anchor, { threshold: 0.9 }).status).toBe("orphan");
  });

  it.each([
    { threshold: NaN },
    { threshold: Infinity },
    { threshold: -0.1 },
    { threshold: 1.1 },
    { searchRadius: -1 },
    { searchRadius: 1.5 },
    { searchRadius: 4097 },
    { maxEdits: -1 },
    { maxEdits: 0.5 },
    { maxEdits: 33 },
  ])("rejects invalid options even when position matches: %j", (options) => {
    expect(() => reanchor("plan", selection("plan", "plan"), options)).toThrow(RangeError);
  });

  it("rejects malformed source selectors rather than silently treating them as an orphan", () => {
    const anchor = selection("plan", "plan");
    expect(() =>
      reanchor("plan", { ...anchor, position: { ...anchor.position, start: -1 } }),
    ).toThrow(RangeError);
    expect(() => reanchor("plan", { ...anchor, quote: { ...anchor.quote, exact: "" } })).toThrow(
      RangeError,
    );
    expect(() =>
      reanchor("plan", { ...anchor, quote: { ...anchor.quote, exact: "other" } }),
    ).toThrow(RangeError);
  });
});
