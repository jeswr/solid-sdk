// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { describe, expect, it } from "vitest";
import {
  MAX_QUERY_LENGTH,
  MAX_QUERY_TERMS,
  parseQuery,
  SearchError,
  type SearchErrorCode,
  type SearchQuery,
} from "../src/apps/chat/lib/search";
import { validateQuery } from "../src/apps/chat/lib/search/validation";

function fails(action: () => unknown, code: SearchErrorCode): void {
  expect(action).toThrow(SearchError);
  expect(action).toThrow(expect.objectContaining({ code, name: "SearchError" }));
  expect(action).toThrow(`Chat search: ${code}`);
}

describe("chat query grammar", () => {
  it("parses words, phrases, negation, every filter and unknown keys", () => {
    const query = parseQuery(
      '\tCafé "garden club" -rain -"bad weather" from:"Mira Vale" in:club before:2026-05-01 after:2026-01-01 on:2026-04-03 has:link has:attachment has:mention is:thread topic:garden other:"blue sky" -unknown:value\n',
    );
    expect(query).toEqual({
      type: "query",
      terms: [
        { type: "word", value: "Café", negated: false },
        { type: "phrase", value: "garden club", negated: false },
        { type: "word", value: "rain", negated: true },
        { type: "phrase", value: "bad weather", negated: true },
        ...[
          ["from", "Mira Vale"],
          ["in", "club"],
          ["before", "2026-05-01"],
          ["after", "2026-01-01"],
          ["on", "2026-04-03"],
          ["has", "link"],
          ["has", "attachment"],
          ["has", "mention"],
          ["is", "thread"],
        ].map(([field, value]) => ({ type: "filter", field, value, negated: false })),
        { type: "word", value: "topic:garden", negated: false },
        { type: "phrase", value: "other:blue sky", negated: false },
        { type: "word", value: "unknown:value", negated: true },
      ],
    });
    expect(parseQuery('"from:Mira"').terms[0]?.type).toBe("phrase");
    expect(parseQuery("unknown:-value").terms[0]?.value).toBe("unknown:-value");
    expect(parseQuery("from:https://example.org/mira#me").terms[0]?.value).toBe(
      "https://example.org/mira#me",
    );
  });

  it("accepts exact query length and term limits and rejects bound + 1", () => {
    expect(parseQuery("x".repeat(MAX_QUERY_LENGTH)).terms).toHaveLength(1);
    fails(() => parseQuery("x".repeat(MAX_QUERY_LENGTH + 1)), "QUERY_TOO_LARGE");
    expect(parseQuery(Array(MAX_QUERY_TERMS).fill("x").join(" ")).terms).toHaveLength(
      MAX_QUERY_TERMS,
    );
    fails(
      () =>
        parseQuery(
          Array(MAX_QUERY_TERMS + 1)
            .fill("x")
            .join(" "),
        ),
      "QUERY_TOO_LARGE",
    );
    // Length preflight wins over malformed Unicode and syntax.
    fails(() => parseQuery(`"${"\ud800".repeat(MAX_QUERY_LENGTH)}`), "QUERY_TOO_LARGE");
    fails(() => parseQuery(`${Array(MAX_QUERY_TERMS).fill("x").join(" ")} "`), "QUERY_TOO_LARGE");
  });

  it.each([
    '"unfinished',
    'word -"unfinished',
    'from:"Mira',
    'a"b',
  ])("rejects unbalanced quotes: %s", (source) =>
    fails(() => parseQuery(source), "UNTERMINATED_PHRASE"));

  it.each([
    "",
    " \n\t",
    "-word",
    '-"garden club" -has:link',
  ])("rejects queries without a positive term: %s", (source) =>
    fails(() => parseQuery(source), "EMPTY_QUERY"));

  it.each([
    "before:2026-02-29",
    "after:2024-02-30",
    "on:1900-02-29",
    "on:0000-01-01",
    "on:2026-13-01",
    "on:2026-01-00",
    "on:2026-1-01",
    "on:not-a-date",
  ])("rejects invalid Gregorian dates: %s", (source) =>
    fails(() => parseQuery(source), "INVALID_DATE"));
  it("accepts leap centuries and low years without Date's year-1900 adjustment", () => {
    for (const date of ["2000-02-29", "2024-02-29", "0001-01-01", "0099-12-31", "9999-12-31"]) {
      expect(parseQuery(`on:${date}`).terms[0]?.value).toBe(date);
    }
  });

  it.each([
    "-",
    '""',
    "from:",
    "has:video",
    "is:unread",
    "word --rain",
    '"a"b',
    'wo"rd"',
    '"a\\b"',
    "a\\b",
    "\u0301",
    "\ud800",
    "a\u0000b",
  ])("fails closed on unsupported input: %s", (source) =>
    fails(() => parseQuery(source), "INVALID_QUERY"));
  it("rejects non-string query input", () =>
    fails(() => parseQuery(null as never), "INVALID_QUERY"));
});

describe("untrusted AST validation", () => {
  it.each([
    null,
    {},
    { type: "other", terms: [] },
    { type: "query", terms: null },
    { type: "query", terms: [null] },
    { type: "query", terms: new Array(1) },
    { type: "query", terms: [{ value: 3 }] },
  ])("rejects malformed ASTs", (query) =>
    fails(() => validateQuery(query as SearchQuery), "INVALID_QUERY"));
  it("checks AST size before traversing or folding its contents", () => {
    fails(
      () => validateQuery({ type: "query", terms: new Array(MAX_QUERY_TERMS + 1) }),
      "QUERY_TOO_LARGE",
    );
    const term = { type: "word" as const, negated: false, value: "x".repeat(MAX_QUERY_LENGTH) };
    validateQuery({ type: "query", terms: [term] });
    fails(
      () => validateQuery({ type: "query", terms: [term, { ...term, value: "x" }] }),
      "QUERY_TOO_LARGE",
    );
  });
  it.each([
    null,
    { value: "x", type: "oops", negated: false },
    { value: "x", type: "word", negated: 0 },
    { value: "two words", type: "word", negated: false },
    { value: "x\u0000", type: "phrase", negated: false },
    { value: "", type: "word", negated: false },
    { value: "x", type: "filter", field: "unknown", negated: false },
  ])("rejects invalid AST terms", (term) =>
    fails(() => validateQuery({ type: "query", terms: [term] } as SearchQuery), "INVALID_QUERY"));
});
