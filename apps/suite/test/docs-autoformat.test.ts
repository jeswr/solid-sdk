// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  AUTOFORMAT_RULE_IDS,
  AutoformatError,
  type AutoformatErrorCode,
  type AutoformatOptions,
  type AutoformatRuleId,
  autoformatInput,
  MAX_AUTOFORMAT_CONTEXT_LENGTH,
  MAX_TYPED_CHARACTER_LENGTH,
} from "../src/apps/docs/lib/autoformat";

const prose = { inCode: false } as const;
const fixtures: readonly [AutoformatRuleId, string, string, string][] = [
  ["en-dash", "a --", " ", "a – "],
  ["em-dash", "a --", "-", "a —"],
  ["ellipsis", "a..", ".", "a…"],
  ["copyright", "a (c", ")", "a ©"],
  ["registered", "a (r", ")", "a ®"],
  ["trademark", "a (tm", ")", "a ™"],
  ["right-arrow", "a-", ">", "a→"],
  ["left-arrow", "a<", "-", "a←"],
  ["double-arrow", "a=", ">", "a⇒"],
  ["half", "a 1/2", " ", "a ½ "],
  ["quarter", "a 1/4", " ", "a ¼ "],
  ["three-quarters", "a 3/4", " ", "a ¾ "],
  ["double-quotes", "a ", '"', "a “"],
  ["single-quotes", "a ", "'", "a ‘"],
];

function transformed(text: string, typed: string, rules?: AutoformatOptions): string {
  const edit = autoformatInput(text, typed, { ...prose, ...(rules ? { rules } : {}) });
  expect(edit).not.toBeNull();
  if (!edit) throw new Error("Expected a replacement");
  const input = text + typed;
  expect(edit.original).toBe(input.slice(edit.from, edit.to));
  const output = input.slice(0, edit.from) + edit.insert + input.slice(edit.to);
  const undone =
    output.slice(0, edit.from) + edit.original + output.slice(edit.from + edit.insert.length);
  expect(undone).toBe(input);
  return output;
}

function errorCode(run: () => unknown, code: AutoformatErrorCode): void {
  expect(run).toThrow(AutoformatError);
  expect(run).toThrow(expect.objectContaining({ name: "AutoformatError", code }));
}

describe("typographic input rules", () => {
  it.each(fixtures)("applies %s with an exact reversible edit", (rule, text, typed, output) => {
    expect(autoformatInput(text, typed, prose)?.rule).toBe(rule);
    expect(transformed(text, typed)).toBe(output);
  });

  it.each(fixtures)("disables %s independently", (rule, text, typed) => {
    expect(autoformatInput(text, typed, { ...prose, rules: { [rule]: false } })).toBeNull();
    expect(transformed(text, typed, { [rule]: true })).toBe(transformed(text, typed));
  });

  it("exports every individual rule id and accepts all options together", () => {
    expect(AUTOFORMAT_RULE_IDS).toEqual(fixtures.map(([id]) => id));
    const rules = Object.fromEntries(AUTOFORMAT_RULE_IDS.map((id) => [id, false]));
    expect(autoformatInput(" --", "-", { ...prose, rules })).toBeNull();
    expect(autoformatInput(" --", "-", { ...prose, rules: { ...rules, "em-dash": true } })).toEqual(
      { from: 1, to: 4, insert: "—", original: "---", rule: "em-dash" },
    );
  });

  it.each(fixtures)("suppresses %s inside inline code", (_rule, text, typed) => {
    expect(autoformatInput(text, typed, { inCode: true })).toBeNull();
  });

  it.each([
    "",
    "--",
    "a--",
    "a\t--",
    "a –",
    "a —",
  ])("requires a literal leading space and two hyphens for en dash: %j", (text) =>
    expect(autoformatInput(text, " ", prose)).toBeNull());

  it("only matches a suffix completed by the typed character", () => {
    for (const [text, typed] of [
      ["...", "x"],
      ["(c)", "x"],
      ["->", "x"],
      ["x", "x"],
    ]) {
      expect(autoformatInput(text as string, typed as string, prose)).toBeNull();
    }
    expect(transformed("...--", "-")).toBe("...—");
    expect(transformed(" --", " ")).toBe(" – ");
    expect(transformed("--", "-")).toBe("—");
    expect(transformed("..", ".")).toBe("…");
  });

  it.each([
    "c",
    "C",
    "r",
    "R",
    "tm",
    "TM",
    "Tm",
    "tM",
  ])("matches symbol %s without case sensitivity", (symbol) => {
    const output = symbol.toLowerCase() === "c" ? "©" : symbol.toLowerCase() === "r" ? "®" : "™";
    expect(transformed(`(${symbol}`, ")")).toBe(output);
  });

  it.each(["(x", "( tM", "（c", "(cc"])("leaves unsupported symbols alone: %s", (text) => {
    expect(autoformatInput(text, ")", prose)).toBeNull();
  });

  it("waits for fraction right boundaries and never converts larger numbers", () => {
    for (const [text, typed] of [
      ["1/", "2"],
      ["1/2", "0"],
      ["11/2", " "],
      ["1/20", " "],
      ["2/4", " "],
    ]) {
      expect(autoformatInput(text as string, typed as string, prose)).toBeNull();
    }
    expect(transformed("1/2", ",")).toBe("½,");
    expect(transformed("(1/4", ")")).toBe("(¼)");
    expect(transformed("x3/4", "x")).toBe("x¾x");
    expect(transformed("1/2", "😀")).toBe("½😀");
  });

  it("treats Unicode decimal digits as numeric fraction boundaries", () => {
    for (const digit of ["0", "٩", "９", "𝟙"]) {
      expect(autoformatInput(`${digit}1/2`, " ", prose)).toBeNull();
      expect(autoformatInput("1/2", digit, prose)).toBeNull();
    }
  });

  it("applies only the highest-priority rule when a fraction ends with a quote", () => {
    expect(transformed("1/2", '"')).toBe('½"');
    expect(transformed("1/2", '"', { half: false })).toBe("1/2”");
  });

  it.each([
    "",
    " ",
    "\t",
    "\n",
    "\u00a0",
    "(",
    "[",
    "{",
    "〈",
    "-",
    "–",
    "—",
  ])("opens quotes after %j", (prefix) => {
    expect(transformed(prefix, '"')).toBe(`${prefix}“`);
    expect(transformed(prefix, "'")).toBe(`${prefix}‘`);
  });

  it.each([
    "a",
    "é",
    "字",
    "𝔄",
    "0",
    ")",
    "]",
    "}",
    ".",
    ",",
    "😀",
    "“",
  ])("closes quotes after %j and preserves letter apostrophes", (prefix) => {
    expect(transformed(prefix, '"')).toBe(`${prefix}”`);
    expect(transformed(prefix, "'")).toBe(`${prefix}’`);
  });

  it("uses UTF-16 edit coordinates and preserves surrounding text", () => {
    expect(autoformatInput("😀 --", "-", prose)).toEqual({
      from: 3,
      to: 6,
      insert: "—",
      original: "---",
      rule: "em-dash",
    });
    expect(transformed("😀 --", "-")).toBe("😀 —");
  });

  it("handles consecutive typing and immediate Backspace without hidden state", () => {
    let text = "";
    for (const typed of 'A -- B --- C... (C) (R) (Tm) -> <- => 1/2 1/4 3/4 "Mira" can\'t') {
      const edit = autoformatInput(text, typed, prose);
      text += typed;
      if (edit) text = text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
    }
    expect(text).toBe("A – B — C… © ® ™ → ← ⇒ ½ ¼ ¾ “Mira” can’t");
    expect(transformed("Mira can", "'")).toBe("Mira can’");
  });
});

describe("window and character bounds", () => {
  it("exports the context and typed-character limits", () => {
    expect(MAX_AUTOFORMAT_CONTEXT_LENGTH).toBe(512);
    expect(MAX_TYPED_CHARACTER_LENGTH).toBe(2);
  });

  it.each([512, 513, 100_000])("accepts %i units and retains full-text offsets", (length) => {
    const text = `${"x".repeat(length - 2)}..`;
    expect(transformed(text, ".")).toBe(`${text.slice(0, -2)}…`);
    expect(autoformatInput(text, ".", prose)?.from).toBe(length - 2);
  });

  it("does not inspect a discarded prefix to supply a fraction boundary", () => {
    const text = `9${"x".repeat(509)}1/2`;
    expect(transformed(text, " ")).toBe(`${text.slice(0, -3)}½ `);
  });

  it("does not split valid surrogate pairs at the window boundary", () => {
    const text = `😀${"x".repeat(509)}..`;
    expect(transformed(text, ".")).toBe(`${text.slice(0, -2)}…`);
    expect(autoformatInput(`😀${"x".repeat(510)}`, "😀", prose)).toBeNull();
  });

  it("accepts one supplementary character at the typed bound; rejects bound+1", () => {
    expect(autoformatInput("", "😀", prose)).toBeNull();
    errorCode(() => autoformatInput("", "😀x", prose), "INVALID_TEXT");
  });

  it.each(["", "ab", "abc", "e\u0301", "👩‍💻"])("rejects non-character typing %j", (typed) => {
    errorCode(() => autoformatInput("", typed, prose), "INVALID_TEXT");
  });
});

describe("typed input errors", () => {
  it.each([
    "\ud800",
    "\udfff",
    "a\ud800x",
    "\ud800\ud800",
    "\udfff\ud800",
  ])("rejects lone surrogates in either input: %j", (invalid) => {
    errorCode(() => autoformatInput(invalid, ".", prose), "INVALID_TEXT");
    errorCode(() => autoformatInput("", invalid, prose), "INVALID_TEXT");
    // Outside the considered 512-unit window: ignored, never scanned.
    expect(autoformatInput(`${invalid}${"x".repeat(512)}`, ".", prose)).toBeNull();
  });

  it("rejects a lone low surrogate at the window start but keeps a clipped valid pair", () => {
    errorCode(() => autoformatInput(`a\udc00${"x".repeat(511)}`, ".", prose), "INVALID_TEXT");
    expect(autoformatInput(`\ud83d\ude00${"x".repeat(511)}`, ".", prose)).toBeNull();
  });

  it("bounds Unicode validation to the window for very long blocks", () => {
    const text = `\ud800${"x".repeat(1_000_000)}..`;
    expect(transformed(text, ".")).toBe(`${text.slice(0, -2)}…`);
  });

  it.each([null, 1, {}, ["x"]])("rejects non-string text %j without coercion", (value) => {
    errorCode(() => autoformatInput(value as string, ".", prose), "INVALID_TEXT");
    errorCode(() => autoformatInput("", value as string, prose), "INVALID_TEXT");
  });

  it.each([
    "typo",
    "toString",
    "__proto__",
    "constructor",
    Symbol("unknown"),
  ])("rejects unknown rule %s", (key) => {
    errorCode(
      () => autoformatInput("", "x", { ...prose, rules: { [key]: false } }),
      "UNKNOWN_RULE",
    );
  });

  it.each([null, [], 1, "x", new Date()])("rejects invalid options %j", (rules) => {
    errorCode(
      () => autoformatInput("", "x", { ...prose, rules: rules as AutoformatOptions }),
      "INVALID_OPTIONS",
    );
  });

  it.each([null, undefined, 0, "false", {}])("rejects invalid flag %j", (flag) => {
    errorCode(
      () => autoformatInput("", "x", { ...prose, rules: { ellipsis: flag as boolean } }),
      "INVALID_OPTIONS",
    );
  });

  it.each([
    undefined,
    null,
    [],
    {},
    { inCode: "false" },
    { inCode: false, extra: 1 },
  ])("rejects malformed context %j", (context) => {
    errorCode(() => autoformatInput("", "x", context as typeof prose), "INVALID_OPTIONS");
  });

  it("accepts a null-prototype rule map and immutable inputs", () => {
    const rules = Object.freeze(Object.assign(Object.create(null), { ellipsis: false }));
    expect(autoformatInput("..", ".", Object.freeze({ ...prose, rules }))).toBeNull();
  });

  it("rejects accessors without invoking them", () => {
    const rules = Object.defineProperty({}, "ellipsis", {
      get() {
        throw new Error("must not run");
      },
    });
    errorCode(() => autoformatInput("", "x", { ...prose, rules }), "INVALID_OPTIONS");
    const context = Object.defineProperty({}, "inCode", {
      get() {
        throw new Error("must not run");
      },
    });
    errorCode(() => autoformatInput("", "x", context as typeof prose), "INVALID_OPTIONS");
  });

  it("rejects hidden fields and disappearing proxy properties", () => {
    const hidden = Object.defineProperty({}, "ellipsis", { value: false });
    errorCode(() => autoformatInput("", "x", { ...prose, rules: hidden }), "INVALID_OPTIONS");
    const missing = new Proxy({}, { ownKeys: () => ["ellipsis"] });
    errorCode(() => autoformatInput("", "x", { ...prose, rules: missing }), "INVALID_OPTIONS");
  });

  it("wraps unreadable proxy options in a typed error", () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    errorCode(() => autoformatInput("", "x", { ...prose, rules: proxy }), "INVALID_OPTIONS");
  });

  it("validates malformed input even when rules are suppressed in code", () => {
    errorCode(() => autoformatInput("\ud800", "x", { inCode: true }), "INVALID_TEXT");
    errorCode(
      () => autoformatInput("", "x", { inCode: true, rules: { typo: false } } as never),
      "UNKNOWN_RULE",
    );
  });

  it("maps a trap that throws a revoked proxy to a typed error", () => {
    const thrown = Proxy.revocable({}, {});
    thrown.revoke();
    const rules = new Proxy(
      {},
      {
        ownKeys() {
          throw thrown.proxy;
        },
      },
    );
    errorCode(() => autoformatInput("", "x", { ...prose, rules }), "INVALID_OPTIONS");
  });
});
