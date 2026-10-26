// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  DEFAULT_GROUP_GAP_MS,
  EMOJI_SHORTCODES,
  groupMessages,
  parseAutolink,
  parseInline,
  parseMessageText,
} from "../src/apps/chat/lib/text";
import { trimLinkEnd } from "../src/apps/chat/lib/text/links";

const text = (value: string) => ({ type: "text", value });
const paragraph = (value: string) => ({ type: "paragraph", children: [text(value)] });
const mira = "https://example.org/people/mira#me";
const options = { mentions: { mira, unsafe: "javascript:alert(1)", broken: "https://[" } };

describe("Markdown-lite inline AST", () => {
  it("preserves plain text, whitespace, emoji and unsupported HTML literally", () => {
    expect(parseInline("")).toEqual([]);
    for (const value of [
      "Hello fictional friend 👋",
      '<script>alert("hi")</script> &lt;b&gt; &amp;',
      '<img src=x onerror="alert(1)">',
      "# Heading\n~~strike~~ [label](javascript:alert(1))",
      "snake_case a_b_c word*fragment*",
      "** ** * * __ __ _ _",
      "unclosed `code and *italic and **bold",
    ]) {
      expect(parseInline(value)).toEqual([text(value)]);
    }
  });

  it.each([
    ["**bold**", "bold"],
    ["__bold__", "bold"],
    ["*italic*", "italic"],
    ["_italic_", "italic"],
  ])("parses %s", (source, type) => {
    expect(parseInline(`Before ${source} after`)).toEqual([
      text("Before "),
      { type, children: [text(type)] },
      text(" after"),
    ]);
  });

  it("nests emphasis and resolves mentions inside formatting", () => {
    expect(parseInline("**Hello *friend* @mira**", options)).toEqual([
      {
        type: "bold",
        children: [
          text("Hello "),
          { type: "italic", children: [text("friend")] },
          text(" "),
          { type: "mention", label: "mira", webId: mira },
        ],
      },
    ]);
  });

  it.each(["*", "_"])("closes nested %s runs before later spans", (marker) => {
    expect(
      parseInline(
        `${marker.repeat(3)}one${marker.repeat(3)} ${marker.repeat(2)}two${marker.repeat(2)}`,
      ),
    ).toEqual([
      { type: "bold", children: [{ type: "italic", children: [text("one")] }] },
      text(" "),
      { type: "bold", children: [text("two")] },
    ]);
    expect(
      parseInline(`${marker}one ${marker.repeat(2)}two${marker.repeat(3)} ${marker}three${marker}`),
    ).toEqual([
      { type: "italic", children: [text("one "), { type: "bold", children: [text("two")] }] },
      text(" "),
      { type: "italic", children: [text("three")] },
    ]);
  });

  it.each(["_", "__", "*", "**"])("preserves intraword underscores inside %s", (marker) => {
    const value = "hello snake_case snake__case snake___case";
    expect(parseInline(`${marker}${value}${marker}`)).toEqual([
      { type: marker.length === 2 ? "bold" : "italic", children: [text(value)] },
    ]);
    expect(
      parseInline(`${marker}hello @mira_sage${marker}`, { mentions: { mira_sage: mira } }),
    ).toEqual([
      {
        type: marker.length === 2 ? "bold" : "italic",
        children: [text("hello "), { type: "mention", label: "mira_sage", webId: mira }],
      },
    ]);
  });

  it("falls back to intact literal input when scans exceed the shared work budget", () => {
    for (const suffix of [
      "@[".repeat(10_000),
      `${"@[".repeat(10_000)}](https://example.org/`,
      "*a ".repeat(10_000),
      `${"**open ".repeat(16)}${"@[".repeat(10_000)}`,
    ]) {
      const source = `**formatted** ${suffix}`;
      expect(parseInline(source)).toEqual([text(source)]);
    }
  });

  it("continues formatting long ordinary inputs within the work budget", () => {
    const body = "ordinary text ".repeat(10_000).trimEnd();
    expect(parseInline(`**${body}**`)).toEqual([{ type: "bold", children: [text(body)] }]);
    const source = "@mira :smile: `code` ".repeat(100);
    expect(parseInline(source, options)).toEqual(
      Array.from({ length: 100 }, () => [
        { type: "mention", label: "mira", webId: mira },
        text(" "),
        { type: "emoji", shortcode: "smile", value: EMOJI_SHORTCODES.smile },
        text(" "),
        { type: "code", value: "code" },
        text(" "),
      ]).flat(),
    );
  });

  it("keeps inline code opaque and handles escapes", () => {
    const literal = "**bold** @mira :smile: https://example.org/ <b>";
    expect(parseInline(`Before \`${literal}\` after`, options)).toEqual([
      text("Before "),
      { type: "code", value: literal },
      text(" after"),
    ]);
    expect(parseInline("\\*literal\\* \\@mira \\:smile: \\`code\\` \\\\ \\q")).toEqual([
      text("*literal* @mira :smile: `code` \\ \\q"),
    ]);
    expect(parseInline("literal", {}, 16)).toEqual([text("literal")]);
  });

  it("matches adjacent nested delimiters and preserves unmatched runs", () => {
    for (const source of ["***both***", "___both___"]) {
      expect(parseInline(source)).toEqual([
        { type: "bold", children: [{ type: "italic", children: [text("both")] }] },
      ]);
    }
    expect(parseInline("*italic **bold***")).toEqual([
      { type: "italic", children: [text("italic "), { type: "bold", children: [text("bold")] }] },
    ]);
    expect(parseInline("**bold *italic***")).toEqual([
      { type: "bold", children: [text("bold "), { type: "italic", children: [text("italic")] }] },
    ]);
    expect(parseInline("**code `**` and \\*literal\\***")).toEqual([
      {
        type: "bold",
        children: [text("code "), { type: "code", value: "**" }, text(" and *literal*")],
      },
    ]);
    for (const value of [
      "**unclosed*",
      "__unclosed_",
      "**unclosed _word",
      "**unclosed * word",
      "**unclosed _",
      "**unclosed `",
    ]) {
      expect(parseInline(value)).toEqual([text(value)]);
    }
    expect(parseInline("**a _b_ c**")).toEqual([
      {
        type: "bold",
        children: [text("a "), { type: "italic", children: [text("b")] }, text(" c")],
      },
    ]);
    expect(parseInline("**a *b* c**", {}, 15)).toEqual([
      { type: "bold", children: [text("a *b* c")] },
    ]);
  });
});

describe("HTTP(S) and WebID autolinking", () => {
  it("uses a punycode hostname for destination and visible label", () => {
    const href = "https://xn--bcher-kva.example.org/profile#me";
    expect(parseAutolink("https://bücher.example.org/profile#me")).toEqual({ href, label: href });
    expect(parseInline("https://bücher.example.org/profile#me")).toEqual([
      { type: "link", href, label: href },
    ]);
    expect(parseAutolink("HTTP://EXAMPLE.ORG:80")).toEqual({
      href: "http://example.org/",
      label: "http://example.org/",
    });
    expect(parseInline(mira)).toEqual([{ type: "link", href: mira, label: mira }]);
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,test",
    "file:///example.org",
    "mailto:mira@example.org",
    "//example.org/",
    "www.example.org",
    "https://",
    "https://[",
    "https://user@example.org/",
    "https://:password@example.org/",
    "https://example.org\\evil",
    "https://example.org/ space",
    "https://example.org/\npath",
    "https://example.org/\u0000",
    "https://example.org/<tag>",
    'https://example.org/"',
    "https://example.org/'",
  ])("rejects unsafe or invalid destination %j", (value) => {
    expect(parseAutolink(value)).toBeNull();
  });

  it("retains balanced brackets and excludes trailing sentence punctuation", () => {
    expect(parseInline("See (https://example.org/a_(b)). Next https://example.org/x]};!")).toEqual([
      text("See ("),
      { type: "link", href: "https://example.org/a_(b)", label: "https://example.org/a_(b)" },
      text("). Next "),
      { type: "link", href: "https://example.org/x", label: "https://example.org/x" },
      text("]};!"),
    ]);
    expect(parseInline("https://example.org/a[b] https://example.org/a{b}")).toEqual([
      { type: "link", href: "https://example.org/a[b]", label: "https://example.org/a[b]" },
      text(" "),
      { type: "link", href: "https://example.org/a%7Bb%7D", label: "https://example.org/a%7Bb%7D" },
    ]);
  });

  it("trims long unmatched bracket suffixes while retaining balanced brackets", () => {
    const suffix = ")].!};".repeat(10_000);
    expect(parseInline(`https://example.org/a_(b)${suffix}`)).toEqual([
      { type: "link", href: "https://example.org/a_(b)", label: "https://example.org/a_(b)" },
      text(suffix),
    ]);
    expect(trimLinkEnd("([{}])")).toBe("([{}])");
    expect(trimLinkEnd(")).]}!;")).toBe("");
    expect(trimLinkEnd("")).toBe("");
  });

  it("preserves invalid URL candidates and avoids linking inside words or email", () => {
    for (const value of [
      "https://[",
      "https://user@example.org/",
      "xhttps://example.org/",
      "mira@https://example.org/",
    ]) {
      expect(parseInline(value)).toEqual([text(value)]);
    }
    expect(parseInline("<https://example.org/?a=1&b=2#me>")).toEqual([
      text("<"),
      {
        type: "link",
        href: "https://example.org/?a=1&b=2#me",
        label: "https://example.org/?a=1&b=2#me",
      },
      text(">"),
    ]);
  });
});

describe("mentions and emoji", () => {
  it("parses handles with exact caller-provided identity mapping", () => {
    expect(
      parseInline("@mira @Mira @unknown @unsafe @broken @mira.sage @mira-sage @mira_2.", options),
    ).toEqual([
      { type: "mention", label: "mira", webId: mira },
      text(" "),
      { type: "mention", label: "Mira", webId: null },
      text(" "),
      { type: "mention", label: "unknown", webId: null },
      text(" "),
      { type: "mention", label: "unsafe", webId: null },
      text(" "),
      { type: "mention", label: "broken", webId: null },
      text(" "),
      { type: "mention", label: "mira.sage", webId: null },
      text(" "),
      { type: "mention", label: "mira-sage", webId: null },
      text(" "),
      { type: "mention", label: "mira_2", webId: null },
      text("."),
    ]);
    expect(parseInline("@mira")).toEqual([{ type: "mention", label: "mira", webId: null }]);
    expect(parseInline("mira@example.org @@mira @ ")).toEqual([text("mira@example.org @@mira @ ")]);
    expect(parseInline("@toString @__proto__", { mentions: {} })).toEqual([
      { type: "mention", label: "toString", webId: null },
      text(" "),
      { type: "mention", label: "__proto__", webId: null },
    ]);
  });

  it("parses explicit WebID mentions without treating labels as markup", () => {
    expect(parseInline(`@[Mira Sage](${mira})`)).toEqual([
      { type: "mention", label: "Mira Sage", webId: mira },
    ]);
    expect(parseInline("@[<b>Mira</b>](https://bücher.example.org/#me)")).toEqual([
      { type: "mention", label: "<b>Mira</b>", webId: "https://xn--bcher-kva.example.org/#me" },
    ]);
    for (const value of [
      "@[Mira](javascript:alert(1))",
      "@[Mira](https://[)",
      "@[Mira](https://user@example.org/)",
      "@[Mira",
      "@[](https://example.org/)",
    ]) {
      expect(parseInline(value)).toEqual([text(value)]);
    }
  });

  it("recognises every supported shortcode, preserving unknown and inherited keys", () => {
    for (const [shortcode, value] of Object.entries(EMOJI_SHORTCODES)) {
      expect(parseInline(`:${shortcode}:`)).toEqual([{ type: "emoji", shortcode, value }]);
    }
    expect(Object.isFrozen(EMOJI_SHORTCODES)).toBe(true);
    expect(parseInline(":unknown: :SMILE: :toString: :__proto__:")).toEqual([
      text(":unknown: :SMILE: :toString: :__proto__:"),
    ]);
  });
});

describe("Markdown-lite blocks", () => {
  it("normalises newlines, separates paragraphs and preserves soft breaks", () => {
    expect(parseMessageText("")).toEqual([]);
    expect(parseMessageText(" \n\t\n")).toEqual([]);
    expect(parseMessageText("one\r\ntwo\r\n\rthree\n\n")).toEqual([
      paragraph("one\ntwo"),
      paragraph("three"),
    ]);
  });

  it("parses adjacent flat lists, quotes and paragraphs with inline content", () => {
    expect(
      parseMessageText(
        "intro\n> **quote**\n> @mira\n- first\n+ second\n* third\n3. third\n4) fourth\nafter",
        options,
      ),
    ).toEqual([
      paragraph("intro"),
      {
        type: "quote",
        children: [
          { type: "bold", children: [text("quote")] },
          text("\n"),
          { type: "mention", label: "mira", webId: mira },
        ],
      },
      {
        type: "list",
        ordered: false,
        start: 1,
        items: [[text("first")], [text("second")], [text("third")]],
      },
      { type: "list", ordered: true, start: 3, items: [[text("third")], [text("fourth")]] },
      paragraph("after"),
    ]);
    expect(parseMessageText(">\n> text")).toEqual([{ type: "quote", children: [text("\ntext")] }]);
    expect(parseMessageText("0. zero")).toEqual([
      { type: "list", ordered: true, start: 0, items: [[text("zero")]] },
    ]);
  });

  it("parses fenced code with optional language and no inline processing", () => {
    expect(
      parseMessageText("before\n```ts\n<script> @mira :smile: **bold**\n\n```\nafter", options),
    ).toEqual([
      paragraph("before"),
      { type: "codeBlock", language: "ts", value: "<script> @mira :smile: **bold**\n" },
      paragraph("after"),
    ]);
    expect(parseMessageText("~~~\nliteral\n~~~")).toEqual([
      { type: "codeBlock", language: null, value: "literal" },
    ]);
    expect(parseMessageText("   ````c++\n```\n~~~\n  `````  ")).toEqual([
      { type: "codeBlock", language: "c++", value: "```\n~~~" },
    ]);
    expect(parseMessageText("```\n```")).toEqual([
      { type: "codeBlock", language: null, value: "" },
    ]);
    expect(parseMessageText("```\nunfinished\n")).toEqual([
      { type: "codeBlock", language: null, value: "unfinished\n" },
    ]);
    expect(parseMessageText("```\n~~~\n```extra\n```")).toEqual([
      { type: "codeBlock", language: null, value: "~~~\n```extra" },
    ]);
  });

  it("keeps unsupported block syntax literal", () => {
    expect(parseMessageText("    > indented\n-\n1.no-space\n```html onclick=x\n>quote")).toEqual([
      paragraph("    > indented\n-\n1.no-space\n```html onclick=x"),
      { type: "quote", children: [text("quote")] },
    ]);
  });
});

describe("message grouping", () => {
  const at = Date.parse("2026-10-25T12:00:00Z");
  const message = (author = mira, timestamp = at) => ({
    author,
    timestamp,
    body: "Synthetic message",
  });

  it("handles empty input and preserves frozen messages and their order", () => {
    expect(groupMessages([])).toEqual([]);
    const first = Object.freeze(message());
    const second = Object.freeze(message(mira, at + DEFAULT_GROUP_GAP_MS));
    const third = Object.freeze(message(mira, at + DEFAULT_GROUP_GAP_MS * 2));
    const input = Object.freeze([first, second, third]);
    const grouped = groupMessages(input);
    expect(grouped).toEqual([{ author: mira, messages: [first, second, third] }]);
    expect(grouped[0]?.messages[0]).toBe(first);
    expect(grouped[0]?.messages).not.toBe(input);
  });

  it("splits on another author and on gaps beyond the inclusive interval", () => {
    const messages = [
      message(),
      message("https://example.org/people/sol#me"),
      message(),
      message(mira, at + DEFAULT_GROUP_GAP_MS + 1),
    ];
    expect(groupMessages(messages).map((group) => group.messages)).toEqual(
      messages.map((item) => [item]),
    );
  });

  it("supports custom and zero gaps and splits backwards timestamps", () => {
    const a = message();
    const b = message();
    const c = message(mira, at + 1);
    const d = message(mira, at - 1);
    expect(groupMessages([a, b, c, d], 0).map((group) => group.messages)).toEqual([
      [a, b],
      [c],
      [d],
    ]);
    expect(groupMessages([a, c], 1)).toEqual([{ author: mira, messages: [a, c] }]);
  });

  it("splits UTC days including dates before the epoch", () => {
    for (const midnight of [Date.parse("2026-10-26T00:00:00Z"), 0]) {
      const messages = [message(mira, midnight - 1), message(mira, midnight)];
      expect(groupMessages(messages)).toHaveLength(2);
    }
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    8.64e15 + 1,
  ])("isolates invalid timestamp %s", (timestamp) => {
    const input = [message(), message(mira, timestamp), message()];
    expect(groupMessages(input).map((group) => group.messages)).toEqual(
      input.map((item) => [item]),
    );
  });

  it.each([
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])("rejects invalid grouping interval %s", (gap) => {
    expect(() => groupMessages([], gap)).toThrow(RangeError);
  });
});
