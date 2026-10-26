// AUTHORED-BY Codex GPT-6.1-Sol
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  evaluateQuery,
  type MessageSummary,
  parseQuery,
  type SearchQuery,
  SearchQueryError,
  type SearchQueryErrorCode,
  type SearchTerm,
  serialiseQuery,
} from "../src/apps/mail/lib/search";

const message: MessageSummary = Object.freeze({
  from: "Mira Vale <mira@example.org>",
  to: Object.freeze(["noel@example.org", "Kit Fen <kit@example.org>"]),
  subject: "Fictional garden club: spring plans",
  snippet: 'Meet by the café. Bring the "blue folder" and C:\\maps.',
  hasAttachment: true,
  unread: true,
  dateSent: Date.parse("2026-04-03T12:00:00Z"),
});

const term = (field: SearchTerm["field"], value: string): SearchTerm => ({
  type: "term",
  field,
  value,
});

function fails(action: () => unknown, code: SearchQueryErrorCode, position: number): void {
  expect(action).toThrow(SearchQueryError);
  expect(action).toThrow(expect.objectContaining({ code, position, name: "SearchQueryError" }));
  expect(action).toThrow(`Mail search: ${code} at ${position}`);
}

function matches(query: string, summary: MessageSummary = message): boolean {
  return evaluateQuery(parseQuery(query), summary);
}

describe("mail query grammar", () => {
  it("parses each listed operator into the canonical AST", () => {
    expect(
      parseQuery(
        'from:mira@example.org to: kit@example.org subject:"garden club" has:attachment is:unread before: 2026-05-01 after:2026-01-01',
      ),
    ).toEqual({
      type: "or",
      clauses: [
        {
          type: "and",
          terms: [
            term("from", "mira@example.org"),
            term("to", "kit@example.org"),
            term("subject", "garden club"),
            term("has", "attachment"),
            term("is", "unread"),
            term("before", "2026-05-01"),
            term("after", "2026-01-01"),
          ],
        },
      ],
    });
  });

  it("gives adjacent terms AND precedence over OR, and negates single terms", () => {
    expect(
      parseQuery('mira -subject:summer OR "blue folder" -has:attachment OR -is:unread'),
    ).toEqual({
      type: "or",
      clauses: [
        {
          type: "and",
          terms: [term("text", "mira"), { type: "not", term: term("subject", "summer") }],
        },
        {
          type: "and",
          terms: [term("text", "blue folder"), { type: "not", term: term("has", "attachment") }],
        },
        { type: "and", terms: [{ type: "not", term: term("is", "unread") }] },
      ],
    });
    expect(matches("missing OR garden club")).toBe(true);
    expect(matches("garden missing OR absent")).toBe(false);
    expect(matches("missing -absent OR garden -absent")).toBe(true);
    expect(matches("garden -club OR absent")).toBe(false);
    expect(matches("-missing")).toBe(true);
    expect(matches("-garden")).toBe(false);
    expect(matches('-"garden club"')).toBe(false);
  });

  it("treats empty/whitespace queries as match all and preserves phrase whitespace", () => {
    for (const query of ["", " \t\r\n\u2003 "]) {
      const ast = parseQuery(query);
      expect(ast).toEqual({ type: "or", clauses: [{ type: "and", terms: [] }] });
      expect(serialiseQuery(ast)).toBe("");
      expect(evaluateQuery(ast, message)).toBe(true);
    }
    expect(parseQuery(' \n " two  spaces "\t')).toEqual({
      type: "or",
      clauses: [{ type: "and", terms: [term("text", " two  spaces ")] }],
    });
  });

  it("supports escaped quotes/backslashes and literal reserved syntax inside quotes", () => {
    expect(matches('"\\"blue folder\\""')).toBe(true);
    expect(matches('"C:\\\\maps"')).toBe(true);
    const query = '"OR" "AND" "NOT" "-negated" "from:literal" "(x){y}|*[]"';
    expect(parseQuery(query).clauses[0]?.terms).toEqual([
      term("text", "OR"),
      term("text", "AND"),
      term("text", "NOT"),
      term("text", "-negated"),
      term("text", "from:literal"),
      term("text", "(x){y}|*[]"),
    ]);
    expect(matches('subject:"spring plans"')).toBe(true);
    expect(parseQuery("or and not").clauses[0]?.terms).toHaveLength(3);
  });

  it.each<[string, SearchQueryErrorCode, number]>([
    ["OR foo", "missing-term", 0],
    ["foo OR", "missing-term", 6],
    ["foo OR   ", "missing-term", 9],
    ["foo OR OR bar", "missing-term", 7],
    ["-", "missing-term", 1],
    ["- foo", "missing-term", 1],
    ["--foo", "unsupported-syntax", 1],
    ["+foo", "unsupported-syntax", 0],
    ["-OR", "unsupported-syntax", 1],
    ["AND", "unsupported-syntax", 0],
    ["foo NOT bar", "unsupported-syntax", 4],
    ["from:", "missing-value", 5],
    ["to: \t", "missing-value", 5],
    ['subject:""', "missing-value", 8],
    ['"  "', "missing-value", 0],
    ['"unfinished', "unterminated-quote", 0],
    ['from:"unfinished', "unterminated-quote", 5],
    ['"bad\\q"', "invalid-escape", 4],
    ['"bad\\', "invalid-escape", 4],
    ['"x"y', "unsupported-syntax", 3],
    ['subject:"x"to:y', "unsupported-syntax", 11],
    ['a"b"', "unsupported-syntax", 1],
    ["a\\b", "unsupported-syntax", 1],
    ["(foo)", "unsupported-syntax", 0],
    ["{foo}", "unsupported-syntax", 0],
    ["foo | bar", "unsupported-syntax", 4],
    ["foo*", "unsupported-syntax", 3],
    ["[foo]", "unsupported-syntax", 0],
    ["cc:kit@example.org", "unsupported-syntax", 3],
    ["FROM:mira", "unsupported-syntax", 5],
    ["text:foo", "unsupported-syntax", 0],
    ["has:drive", "unsupported-syntax", 4],
    ["has:Attachment", "unsupported-syntax", 4],
    ["is:read", "unsupported-syntax", 3],
    ["is:Unread", "unsupported-syntax", 3],
    ["from:to:kit", "unsupported-syntax", 7],
    ["x\u0000y", "unsupported-syntax", 1],
    ['"x\u007fy"', "unsupported-syntax", 2],
    ["😀 \u0001", "unsupported-syntax", 3],
    ["before:2026-02-29", "invalid-date", 7],
    ["after:1900-02-29", "invalid-date", 6],
    ["before:2026-04-31", "invalid-date", 7],
    ["before:2026-13-01", "invalid-date", 7],
    ["after:2026-00-01", "invalid-date", 6],
    ["after:2026-01-00", "invalid-date", 6],
    ["after:0000-01-01", "invalid-date", 6],
    ["after:10000-01-01", "invalid-date", 6],
    ["after:2026-1-01", "invalid-date", 6],
    ["after:2026/01/01", "invalid-date", 6],
    ["after:2026-01-01T00:00:00Z", "unsupported-syntax", 19],
  ])("rejects %j with a typed source position", (query, code, position) => {
    fails(() => parseQuery(query), code, position);
  });

  it("rejects non-string queries without coercion or input disclosure", () => {
    for (const query of [null, undefined, 12, {}, ["from:mira"]]) {
      fails(() => parseQuery(query as string), "invalid-query", 0);
    }
    expect(() => parseQuery("secretOperator:private-content")).toThrow(
      "Mail search: unsupported-syntax at 15",
    );
  });
});

describe("mail summary evaluation", () => {
  it.each([
    ["from:MIRA", true],
    ["from:noel", false],
    ["to:KIT", true],
    ["to:mira", false],
    ['to:"Kit Fen"', true],
    ["subject:SPRING", true],
    ["subject:café", false],
    ["has:attachment", true],
    ["is:unread", true],
    ['"garden club"', true],
    ['"club garden"', false],
    ["MIRA", true],
    ["noel", true],
    ["spring", true],
    ["café", true],
    ["cafe", false],
    ['"plans Meet"', false],
    ["absent", false],
  ])("evaluates %j as %j", (query, result) => {
    expect(matches(query as string)).toBe(result);
  });

  it("uses explicit flags, handles empty fields/recipients, and never mutates inputs", () => {
    const empty: MessageSummary = Object.freeze({
      ...message,
      from: "",
      to: Object.freeze([]),
      subject: "",
      snippet: "",
      hasAttachment: false,
      unread: false,
    });
    expect(matches("has:attachment", empty)).toBe(false);
    expect(matches("is:unread", empty)).toBe(false);
    expect(matches("-has:attachment -is:unread", empty)).toBe(true);
    expect(matches("to:kit", empty)).toBe(false);
    expect(matches("any", empty)).toBe(false);
    const ast = parseQuery("garden -subject:summer");
    Object.freeze(ast.clauses[0]?.terms);
    Object.freeze(ast.clauses[0]);
    Object.freeze(ast.clauses);
    Object.freeze(ast);
    expect(evaluateQuery(ast, message)).toBe(true);
    expect(serialiseQuery(ast)).toBe('"garden" -subject:"summer"');
  });

  it("compares strict UTC midnight boundaries at millisecond precision", () => {
    const midnight = Date.parse("2026-04-03T00:00:00Z");
    for (const [offset, before, after] of [
      [-1, true, false],
      [0, false, false],
      [1, false, true],
    ] as const) {
      const summary = { ...message, dateSent: midnight + offset };
      expect(matches("before:2026-04-03", summary)).toBe(before);
      expect(matches("after:2026-04-03", summary)).toBe(after);
    }
    expect(matches("after:2026-04-01 before:2026-04-04")).toBe(true);
    expect(matches("after:2026-04-04 before:2026-04-01")).toBe(false);
    expect(matches("-before:2026-04-03")).toBe(true);
    expect(matches("after:2026-04-04")).toBe(false);
  });

  it("accepts Gregorian leap years and the complete supported UTC range", () => {
    for (const date of ["0001-01-01", "0099-12-31", "2000-02-29", "2024-02-29", "9999-12-31"]) {
      const summary = { ...message, dateSent: Date.parse(`${date}T12:00:00Z`) };
      expect(matches(`after:${date}`, summary)).toBe(true);
      expect(matches(`before:${date}`, summary)).toBe(false);
    }
    expect(matches("", { ...message, dateSent: -62_135_596_800_000 })).toBe(true);
    expect(matches("", { ...message, dateSent: 253_402_300_799_999 })).toBe(true);
  });

  it("rejects incomplete or mistyped summaries before short-circuiting", () => {
    const invalid: unknown[] = [
      null,
      undefined,
      {},
      { ...message, from: null },
      { ...message, to: null },
      { ...message, to: Array(1) },
      { ...message, to: [1] },
      { ...message, subject: null },
      { ...message, snippet: undefined },
      { ...message, hasAttachment: 1 },
      { ...message, unread: "false" },
    ];
    for (const dateSent of [
      NaN,
      Infinity,
      0.5,
      "2026-04-03",
      new Date(),
      -62_135_596_800_001,
      253_402_300_800_000,
    ]) {
      invalid.push({ ...message, dateSent });
    }
    for (const summary of invalid) {
      fails(() => evaluateQuery(parseQuery(""), summary as MessageSummary), "invalid-message", 0);
    }
  });
});

describe("mail query serialisation", () => {
  it("round-trips every term, quoted syntax, escapes, whitespace and negation", () => {
    const queries = [
      "",
      'from: Mira to:"Kit Fen" subject:"Garden Club" has:attachment is:unread',
      'before:2000-02-29 after:0001-01-01 -subject:summer OR "OR"',
      '"-x" "(literal)" "from:literal" "\\"quotes\\"" "C:\\\\maps"',
      '-" two  spaces " OR "line\nbreak"',
    ];
    for (const query of queries) {
      const ast = parseQuery(query);
      const serialised = serialiseQuery(ast);
      expect(parseQuery(serialised)).toEqual(ast);
      expect(serialiseQuery(parseQuery(serialised))).toBe(serialised);
      expect(evaluateQuery(parseQuery(serialised), message)).toBe(evaluateQuery(ast, message));
    }
    expect(serialiseQuery(parseQuery("foo OR -from:mira"))).toBe('"foo" OR -from:"mira"');
  });

  it("round-trips generated literal text without converting it to syntax", () => {
    const literal = fc.string({ minLength: 1, maxLength: 40 }).filter(
      (value) =>
        // biome-ignore lint/suspicious/noControlCharactersInRegex: generate only supported literal text
        value.trim() !== "" && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value),
    );
    fc.assert(
      fc.property(literal, literal, (a, b) => {
        const ast: SearchQuery = {
          type: "or",
          clauses: [
            { type: "and", terms: [term("text", a), { type: "not", term: term("subject", b) }] },
            { type: "and", terms: [term("from", b)] },
          ],
        };
        const reparsed = parseQuery(serialiseQuery(ast));
        expect(reparsed).toEqual(ast);
        expect(evaluateQuery(reparsed, message)).toBe(evaluateQuery(ast, message));
      }),
      { numRuns: 250, seed: 260426 },
    );
  });

  it("rejects unrepresentable ASTs, including invalid nodes hidden behind a match", () => {
    const invalid: unknown[] = [
      null,
      {},
      { type: "and", clauses: [] },
      { type: "or", clauses: null },
      { type: "or", clauses: [] },
      { type: "or", clauses: Array(1) },
    ];
    for (const clause of [null, {}, { type: "and", terms: null }]) {
      invalid.push({ type: "or", clauses: [clause] });
    }
    invalid.push({
      type: "or",
      clauses: [
        { type: "and", terms: [] },
        { type: "and", terms: [] },
      ],
    });
    invalid.push({ type: "or", clauses: [{ type: "and", terms: Array(1) }] });
    for (const node of [
      null,
      {},
      { type: "or" },
      { type: "term", field: "text", value: 1 },
      { type: "term", field: "text", value: "\u0000" },
      { type: "not", term: null },
      { type: "not", term: { type: "not", term: term("text", "x") } },
    ]) {
      invalid.push({
        type: "or",
        clauses: [{ type: "and", terms: [term("text", "garden"), node] }],
      });
    }
    for (const ast of invalid) {
      fails(() => serialiseQuery(ast as SearchQuery), "invalid-ast", 0);
      fails(() => evaluateQuery(ast as SearchQuery, message), "invalid-ast", 0);
    }
    for (const [node, code] of [
      [{ type: "term", field: "cc", value: "kit" }, "unsupported-syntax"],
      [term("has", "drive"), "unsupported-syntax"],
      [term("text", ""), "missing-value"],
      [term("before", "2026-02-29"), "invalid-date"],
    ] as const) {
      const ast = { type: "or", clauses: [{ type: "and", terms: [node] }] } as SearchQuery;
      fails(() => serialiseQuery(ast), code, 0);
      fails(() => evaluateQuery(ast, message), code, 0);
    }
  });
});
