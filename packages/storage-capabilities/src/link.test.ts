// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, test } from "vitest";
import { parseLinkHeaders } from "./link.js";

const base = "http://example.com/TheBook/chapter3";

describe("RFC 8288 §3.5 examples and parameter grammar (12 table cases)", () => {
  test.each([
    {
      name: "previous chapter with title (§3.5)",
      header: '<http://example.com/TheBook/chapter2>; rel="previous"; title="previous chapter"',
      expected: [
        { target: "http://example.com/TheBook/chapter2", context: base, rel: ["previous"] },
      ],
    },
    {
      name: "extension relation (§3.5)",
      header: '</>; rel="http://example.net/foo"',
      expected: [{ target: "http://example.com/", context: base, rel: ["http://example.net/foo"] }],
    },
    {
      name: "fragment anchor (§3.5)",
      header: '</terms>; rel="copyright"; anchor="#foo"',
      expected: [
        { target: "http://example.com/terms", context: `${base}#foo`, rel: ["copyright"] },
      ],
    },
    {
      name: "two links with extended title parameters (§3.5)",
      header:
        "</TheBook/chapter2>; rel=previous; title*=UTF-8'de'letztes%20Kapitel, </TheBook/chapter4>; rel=next; title*=UTF-8'de'n%c3%a4chstes%20Kapitel",
      expected: [
        { target: "http://example.com/TheBook/chapter2", context: base, rel: ["previous"] },
        { target: "http://example.com/TheBook/chapter4", context: base, rel: ["next"] },
      ],
    },
    {
      name: "multiple relation types (§3.5)",
      header: '<http://example.org/>; rel="start http://example.net/relation/other"',
      expected: [
        {
          target: "http://example.org/",
          context: base,
          rel: ["start", "http://example.net/relation/other"],
        },
      ],
    },
    {
      name: "combined headers (§3.5)",
      header: '<https://example.org/>; rel="start", <https://example.org/index>; rel="index"',
      expected: [
        { target: "https://example.org/", context: base, rel: ["start"] },
        { target: "https://example.org/index", context: base, rel: ["index"] },
      ],
    },
    {
      name: "separate headers (§3.5)",
      header: ['<https://example.org/>; rel="start"', '<https://example.org/index>; rel="index"'],
      expected: [
        { target: "https://example.org/", context: base, rel: ["start"] },
        { target: "https://example.org/index", context: base, rel: ["index"] },
      ],
    },
    {
      name: "absolute anchor changes context, never the target base",
      header: '<next>; rel=next; anchor="https://other.example/elsewhere"',
      expected: [
        {
          target: "http://example.com/TheBook/next",
          context: "https://other.example/elsewhere",
          rel: ["next"],
        },
      ],
    },
    {
      name: "relative anchor",
      header: '<next>; rel=next; anchor="../index"',
      expected: [
        {
          target: "http://example.com/TheBook/next",
          context: "http://example.com/index",
          rel: ["next"],
        },
      ],
    },
    {
      name: "case-insensitive names and relations, whitespace and token form",
      header: '\t <next> ; ReL = "NEXT  Alternate" ; title = Chapter\t',
      expected: [
        { target: "http://example.com/TheBook/next", context: base, rel: ["next", "alternate"] },
      ],
    },
    {
      name: "quoted delimiters and escaped quotes",
      header: '<a,b;c>; rel=next; title="a, b; \\"quoted\\""',
      expected: [{ target: "http://example.com/TheBook/a,b;c", context: base, rel: ["next"] }],
    },
    {
      name: "empty target resolves to the response URL",
      header: "<>; rel=self",
      expected: [{ target: base, context: base, rel: ["self"] }],
    },
  ])("$name", ({ header, expected }) => {
    expect(
      parseLinkHeaders(header, base).map(({ target, context, rel }) => ({ target, context, rel })),
    ).toEqual(expected);
  });
});

test("unquotes parameter values, preserves repeated attributes, ignores repeated singletons", () => {
  const [link] = parseLinkHeaders(
    '<next>; rel=NEXT; rel=prev; anchor=""; anchor="https://evil.example/"; title="a, b; \\"quoted\\""; title=ignored; type="text/plain"; type=ignored; media=screen; media=ignored; title*=encoded; title*=ignored; hreflang=en; hreflang=de; flag; __proto__=safe',
    base,
  );
  expect(link).toEqual({
    target: "http://example.com/TheBook/next",
    context: base,
    rel: ["next"],
    parameters: [
      ["rel", "NEXT"],
      ["anchor", ""],
      ["title", 'a, b; "quoted"'],
      ["type", "text/plain"],
      ["media", "screen"],
      ["title*", "encoded"],
      ["hreflang", "en"],
      ["hreflang", "de"],
      ["flag", ""],
      ["__proto__", "safe"],
    ],
  });
});

test.each([
  null,
  [],
  "",
  " \t",
  "garbage",
  "<missing-close",
  '<x>; rel="unterminated',
  "<x>; rel=next; =invalid",
  "<x>; rel=next trailing",
])("ignores empty or malformed fields: %j", (value) =>
  expect(parseLinkHeaders(value, base)).toEqual([]));

test("ignores missing relations and invalid URLs, retaining other links and fields", () => {
  expect(
    parseLinkHeaders(
      [
        '<no-rel>, <empty>; rel="", <http://[>; rel=next, <x>; rel=next; anchor="http://[", <ok>; rel=next, malformed, <lost>; rel=prev',
        "<last>; rel=prev",
      ],
      base,
    ).map(({ target }) => target),
  ).toEqual(["http://example.com/TheBook/ok", "http://example.com/TheBook/last"]);
});

test("normalises the response URL and rejects an invalid base URL", () => {
  expect(parseLinkHeaders("<next>; rel=next", "HTTPS://EXAMPLE.COM:443/a")[0]?.context).toBe(
    "https://example.com/a",
  );
  expect(() => parseLinkHeaders(null, "relative")).toThrow(TypeError);
});
