// AUTHORED-BY GPT-6.1-Sol
import { describe, expect, test } from "vitest";
import { LinkHeaderOverflowError, parseLinkHeaders } from "./link.js";

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
  ).toEqual([
    "http://example.com/TheBook/ok",
    "http://example.com/TheBook/lost",
    "http://example.com/TheBook/last",
  ]);
});

test("normalises the response URL and rejects an invalid base URL", () => {
  expect(parseLinkHeaders("<next>; rel=next", "HTTPS://EXAMPLE.COM:443/a")[0]?.context).toBe(
    "https://example.com/a",
  );
  expect(() => parseLinkHeaders(null, "relative")).toThrow(TypeError);
});

test.each([
  "garbage",
  "<x>; rel=next; =invalid",
  "<x>; rel=next trailing",
  "<x>; rel=next;",
  "<x>; rel=next; title=",
  "<x>; rel=next; title==",
  '<x>; rel=next; title="bad\nvalue"',
  '<x>; rel=next; title="bad\\\nvalue"',
  "<<x>; rel=next",
  "<x\r>; rel=next",
  "<x>; rel=next; title=(bad)",
  '<x>; rel=next; title="a,b" garbage',
  "<a,b>; rel=next garbage",
  '<x> ";" rel=next',
  '<x>; rel "=" next',
  '<x>; rel=next; "title"=bad',
  '<x>; rel=next; title="bad\u0000value"',
  '<x>; rel=next; title="good\tvalue" trailing',
])("skips a malformed member and recovers at the next separator: %j", (member) => {
  expect(parseLinkHeaders(`${member}, <good>; rel=next`, base).map(({ target }) => target)).toEqual(
    ["http://example.com/TheBook/good"],
  );
});

test.each([
  '<x>; title="unfinished\\',
  '<x>; title="unfinished',
  "<unfinished",
])("an unterminated delimiter does not prevent parsing the next field: %j", (member) => {
  expect(parseLinkHeaders([member, "<good>; rel=next"], base).map(({ target }) => target)).toEqual([
    "http://example.com/TheBook/good",
  ]);
});

test("skips empty list members and unquotes escaped backslashes", () => {
  const [link] = parseLinkHeaders(', , <x>; rel=next; title="a\\\\b", ,', base);
  expect(link?.parameters).toEqual([
    ["rel", "next"],
    ["title", "a\\b"],
  ]);
});

test("accepts 8 KiB and ignores entire oversized fields while retaining separate fields", () => {
  const prefix = '<x>; rel=next; title="';
  const atLimit = `${prefix}${"a".repeat(8192 - prefix.length - 1)}"`;
  expect(parseLinkHeaders(atLimit, base)).toHaveLength(1);
  expect(
    parseLinkHeaders([`${atLimit} `, "<good>; rel=next"], base).map(({ target }) => target),
  ).toEqual(["http://example.com/TheBook/good"]);
  // Enforce the byte bound even when the UTF-16 string length is below it.
  expect(parseLinkHeaders(`${prefix}${"é".repeat(4096)}"`, base)).toEqual([]);
});

test("stops at 64 members across combined and separate fields", () => {
  const fields = Array.from({ length: 65 }, (_, i) => `<${i}>; rel=next`);
  expect(parseLinkHeaders(fields.join(","), base).map(({ target }) => target)).toEqual(
    fields.slice(0, 64).map((_, i) => `http://example.com/TheBook/${i}`),
  );
  expect(parseLinkHeaders(fields, base)).toHaveLength(64);
  expect(
    parseLinkHeaders([Array(64).fill("malformed").join(","), fields[0] as string], base),
  ).toEqual([]);
});

describe("explicit Link parsing bounds", () => {
  test("strict mode accepts exact byte/member limits, including trailing empty members", () => {
    const value = '<x>; rel=next; title="é"';
    const maxBytes = new TextEncoder().encode(value).byteLength;
    expect(
      parseLinkHeaders(value, base, { maxBytes, maxMembers: 1, onOverflow: "throw" }),
    ).toHaveLength(1);
    expect(
      parseLinkHeaders(["<a>; rel=next, ,", " , <b>; rel=prev, ,"], base, {
        maxMembers: 2,
        onOverflow: "throw",
      }),
    ).toHaveLength(2);
    expect(
      parseLinkHeaders(Array(64).fill("<x>; rel=next"), base, { onOverflow: "throw" }),
    ).toHaveLength(64);
    expect(
      parseLinkHeaders(null, base, { maxBytes: 0, maxMembers: 0, onOverflow: "throw" }),
    ).toEqual([]);
    expect(parseLinkHeaders("", base, { maxBytes: 0, maxMembers: 0, onOverflow: "throw" })).toEqual(
      [],
    );
  });

  test("strict mode rejects oversized fields, including UTF-8 overflow and later fields", () => {
    for (const values of [
      "x".repeat(8193),
      "é".repeat(4097),
      ["<x>; rel=next", "x".repeat(8193)],
    ]) {
      const error = (() => {
        try {
          parseLinkHeaders(values, base, { onOverflow: "throw" });
        } catch (error) {
          return error;
        }
      })();
      expect(error).toBeInstanceOf(LinkHeaderOverflowError);
      expect(error).toBeInstanceOf(Error);
      expect(error).toMatchObject({ name: "LinkHeaderOverflowError", limit: "maxBytes" });
      expect(String(error)).not.toContain("é");
    }
  });

  test("strict mode counts malformed members and rejects overflow across all fields", () => {
    const members = Array(65).fill("<x>; rel=next");
    for (const values of [
      members.join(","),
      members,
      [Array(64).fill("malformed").join(","), "<x>; rel=next"],
    ]) {
      expect(() => parseLinkHeaders(values, base, { onOverflow: "throw" })).toThrow(
        LinkHeaderOverflowError,
      );
      expect(() => parseLinkHeaders(values, base, { onOverflow: "throw" })).toThrow("maxMembers");
    }
    expect(() =>
      parseLinkHeaders("malformed", base, { maxMembers: 0, onOverflow: "throw" }),
    ).toThrow(LinkHeaderOverflowError);
  });

  test("larger bounds allow full inspection; custom truncation retains the original policy", () => {
    const values = Array(70).fill(`<x>; rel=next; title="${"x".repeat(120)}"`);
    const joined = values.join(",");
    expect(joined.length).toBeGreaterThan(8192);
    expect(
      parseLinkHeaders(joined, base, {
        maxBytes: 65536,
        maxMembers: 1024,
        onOverflow: "throw",
      }),
    ).toHaveLength(70);
    expect(
      parseLinkHeaders(["oversized".repeat(3), "<x>; rel=next"], base, {
        maxBytes: 15,
        maxMembers: 1,
        onOverflow: "truncate",
      }),
    ).toHaveLength(1);
    expect(parseLinkHeaders(values, base, { maxMembers: 2 })).toHaveLength(2);
    expect(parseLinkHeaders("<x>; rel=next", base, { maxMembers: 0 })).toEqual([]);
  });

  test("rejects invalid configured limits", () => {
    for (const limit of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => parseLinkHeaders(null, base, { maxBytes: limit })).toThrow(RangeError);
      expect(() => parseLinkHeaders(null, base, { maxMembers: limit })).toThrow(RangeError);
      expect(() => parseLinkHeaders(null, base, { maxResolvedBytes: limit })).toThrow(RangeError);
    }
  });

  test.each([
    "truncate",
    "throw",
  ] as const)("%s accepts exact cumulative target and context lengths across fields", (onOverflow) => {
    const values = ["<#a>; rel=next", '<urn:b>; rel=prev; anchor="#context"'];
    const expected = parseLinkHeaders(values, base);
    const maxResolvedBytes = expected.reduce(
      (sum, { target, context }) => sum + target.length + context.length,
      0,
    );
    expect(parseLinkHeaders(values, base, { maxResolvedBytes, onOverflow })).toEqual(expected);
    expect(parseLinkHeaders(values.join(","), base, { maxResolvedBytes, onOverflow })).toEqual(
      expected,
    );
    const options = { maxResolvedBytes: maxResolvedBytes - 1, onOverflow };
    if (onOverflow === "throw") {
      expect(() => parseLinkHeaders(values, base, options)).toThrow(LinkHeaderOverflowError);
      expect(() => parseLinkHeaders(values, base, options)).toThrow("maxResolvedBytes");
    } else {
      // Stop at the overflowing member, even if a later link would fit.
      expect(parseLinkHeaders([...values, "<urn:x>; rel=x; anchor=urn:y"], base, options)).toEqual(
        expected.slice(0, 1),
      );
    }
  });

  test("counts duplicate targets and contexts, but only once per member with repeated relations", () => {
    const member = '<#same>; rel="next next prev"; anchor="#same"; anchor="#ignored"';
    const maxResolvedBytes = 2 * `${base}#same`.length;
    expect(parseLinkHeaders(member, base, { maxResolvedBytes, onOverflow: "throw" })).toHaveLength(
      1,
    );
    expect(() =>
      parseLinkHeaders([member, member], base, { maxResolvedBytes, onOverflow: "throw" }),
    ).toThrow("maxResolvedBytes");
  });

  test("counts resolved URL code units after non-ASCII references are serialised", () => {
    const member = '<urn:📖>; rel=x; anchor="urn:🔖"';
    const expected = parseLinkHeaders(member, base);
    const target = "urn:%F0%9F%93%96";
    const context = "urn:%F0%9F%94%96";
    const maxResolvedBytes = target.length + context.length;
    expect(parseLinkHeaders(member, base, { maxResolvedBytes, onOverflow: "throw" })).toEqual(
      expected,
    );
    expect(expected).toMatchObject([{ target, context }]);
    expect(parseLinkHeaders(member, base, { maxResolvedBytes: maxResolvedBytes - 1 })).toEqual([]);
  });

  test("a zero resolved budget accepts empty and invalid members only", () => {
    const options = { maxResolvedBytes: 0, onOverflow: "throw" } as const;
    expect(parseLinkHeaders(null, base, options)).toEqual([]);
    expect(
      parseLinkHeaders(
        'malformed, <no-rel>, <http://[>; rel=x, <x>; rel=x; anchor="http://["',
        base,
        options,
      ),
    ).toEqual([]);
    expect(() => parseLinkHeaders("<urn:x>; rel=x", base, options)).toThrow("maxResolvedBytes");
  });

  test("resolved lengths are unlimited by default; an explicit budget bounds long-base expansion", () => {
    const longBase = `${base}?token=${"x".repeat(9000)}`;
    const values = Array.from({ length: 64 }, (_, i) => `<#${i}>; rel=x`);
    const links = parseLinkHeaders(values, longBase);
    expect(links).toHaveLength(64);
    expect(
      links.reduce((sum, { target, context }) => sum + target.length + context.length, 0),
    ).toBeGreaterThan(1024 * 1024);
    expect(() =>
      parseLinkHeaders(values, longBase, { maxResolvedBytes: 1024 * 1024, onOverflow: "throw" }),
    ).toThrow("maxResolvedBytes");
  });
});

test("parses pathological whitespace, escapes, and unterminated input in under 50 ms", () => {
  const inputs = [
    `<x>; rel=next; flag${" ".repeat(8100)}!`,
    `<x>; rel=next; title="${"\\\\".repeat(4000)}`,
    `<${"x".repeat(8191)}`,
  ];
  const start = performance.now();
  const results = inputs.map((input) => parseLinkHeaders(input, base));
  const elapsed = performance.now() - start;
  expect(results).toEqual([[], [], []]);
  expect(elapsed).toBeLessThan(50);
});
