// @vitest-environment jsdom
// AUTHORED-BY Codex
import { getSchema, type JSONContent } from "@tiptap/react";
import fc from "fast-check";
import { expect, it, vi } from "vitest";
import { baseExtensions } from "../src/apps/docs/editor/extensions";
import { exportMarkdown, importMarkdown } from "../src/apps/docs/lib/convert/markdown";

const schema = getSchema(baseExtensions(vi.fn()));
const text = (value: string, mark?: string): JSONContent => ({
  type: "text",
  text: value,
  ...(mark ? { marks: [{ type: mark }] } : {}),
});
const p = (...content: (string | JSONContent)[]): JSONContent => ({
  type: "paragraph",
  content: content.map((child) => (typeof child === "string" ? text(child) : child)),
});
const code = (value: string, language: string | null = null): JSONContent => ({
  type: "codeBlock",
  attrs: { language },
  content: [text(value)],
});
const quote = (...content: JSONContent[]): JSONContent => ({ type: "blockquote", content });
const list = (...items: JSONContent[][]): JSONContent => ({
  type: "bulletList",
  content: items.map((content) => ({ type: "listItem", content })),
});
const link = (
  value: string,
  href: string,
  title: string | null = null,
  marks: string[] = [],
): JSONContent => ({
  type: "text",
  text: value,
  marks: [{ type: "link", attrs: { href, title } }, ...marks.map((type) => ({ type }))],
});
const image = (alt: string, src: string, title: string | null = null): JSONContent => ({
  type: "image",
  attrs: { alt, src, title },
});

type Example = { section: string; name: string; markdown: string; content: JSONContent[] };
// CommonMark 0.31.2 examples, with expected HTML expressed in the Docs schema.
// https://spec.commonmark.org/0.31.2/
// Relative destinations in the Links examples are prefixed with https://example.org:
// Docs intentionally rejects relative URLs. Code blocks omit HTML's terminal LF;
// lists whose first block is code need an initial empty paragraph in this schema.
// Each expectation checks the entire document, including every mark/attribute.
const examples: Example[] = [
  {
    section: "tabs",
    name: "tab-indented code retains content tabs",
    markdown: "\tfoo\tbaz\t\tbim",
    content: [code("foo\tbaz\t\tbim")],
  },
  {
    section: "tabs",
    name: "spaces followed by a structural tab",
    markdown: "  \tfoo\tbaz\t\tbim",
    content: [code("foo\tbaz\t\tbim")],
  },
  {
    section: "tabs",
    name: "tabs inside indented code",
    markdown: "    a\ta\n    ὐ\ta",
    content: [code("a\ta\nὐ\ta")],
  },
  {
    section: "tabs",
    name: "list continuation at a tab stop",
    markdown: "  - foo\n\n\tbar",
    content: [list([p("foo"), p("bar")])],
  },
  {
    section: "tabs",
    name: "two tabs after a bullet",
    markdown: "-\t\tfoo",
    content: [list([p(), code("  foo")])],
  },
  {
    section: "tabs",
    name: "partial structural tab in a quote",
    markdown: ">\t\tfoo",
    content: [quote(code("  foo"))],
  },
  {
    section: "tabs",
    name: "tab after heading marker",
    markdown: "#\tFoo",
    content: [{ type: "heading", attrs: { level: 1 }, content: [text("Foo")] }],
  },
  {
    section: "backslash-escapes",
    name: "escaped ASCII punctuation",
    markdown:
      "\\!\\\"\\#\\$\\%\\&\\'\\(\\)\\*\\+\\,\\-\\.\\/\\:\\;\\<\\=\\>\\?\\@\\[\\\\\\]\\^\\_\\`\\{\\|\\}\\~",
    content: [p("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~")],
  },
  {
    section: "backslash-escapes",
    name: "nonpunctuation is not escapable",
    markdown: "\\\t\\A\\a\\ \\3\\φ\\«",
    content: [p("\\\t\\A\\a\\ \\3\\φ\\«")],
  },
  {
    section: "backslash-escapes",
    name: "escaped delimiters remain text",
    markdown:
      '\\*not emphasized*\n\\<br/> not a tag\n\\[not a link](/foo)\n\\`not code\\`\n1\\. not a list\n\\* not a list\n\\# not a heading\n\\[foo]: /url "not a reference"\n\\&ouml; not a character entity',
    content: [
      p(
        '*not emphasized*\n<br/> not a tag\n[not a link](/foo)\n`not code`\n1. not a list\n* not a list\n# not a heading\n[foo]: /url "not a reference"\n&ouml; not a character entity',
      ),
    ],
  },
  {
    section: "backslash-escapes",
    name: "escaped backslash before emphasis",
    markdown: "\\\\*emphasis*",
    content: [p("\\", text("emphasis", "italic"))],
  },
  {
    section: "backslash-escapes",
    name: "escaped line ending is a hard break",
    markdown: "foo\\\nbar",
    content: [p("foo", { type: "hardBreak" }, "bar")],
  },
  {
    section: "backslash-escapes",
    name: "escapes in a reference definition",
    markdown: '[foo]\n\n[foo]: https://example.org/bar\\* "ti\\*tle"',
    content: [p(link("foo", "https://example.org/bar*", "ti*tle"))],
  },
  {
    section: "entity-and-numeric-character-references",
    name: "named references",
    markdown:
      "&nbsp; &amp; &copy; &AElig; &Dcaron;\n&frac34; &HilbertSpace; &DifferentialD;\n&ClockwiseContourIntegral; &ngE;",
    content: [p("\u00a0 & © Æ Ď\n¾ ℋ ⅆ\n∲ ≧̸")],
  },
  {
    section: "entity-and-numeric-character-references",
    name: "decimal references and replacement character",
    markdown: "&#35; &#1234; &#992; &#0;",
    content: [p("# Ӓ Ϡ �")],
  },
  {
    section: "entity-and-numeric-character-references",
    name: "hexadecimal references",
    markdown: "&#X22; &#XD06; &#xcab;",
    content: [p('" ആ ಫ')],
  },
  {
    section: "entity-and-numeric-character-references",
    name: "invalid and unterminated references",
    markdown: "&nbsp &x; &#; &#x; &#87654321;\n&#abcdef0; &ThisIsNotDefined; &hi?;",
    content: [p("&nbsp &x; &#; &#x; &#87654321;\n&#abcdef0; &ThisIsNotDefined; &hi?;")],
  },
  {
    section: "entity-and-numeric-character-references",
    name: "not decoded recursively",
    markdown: "&amp;copy;",
    content: [p("&copy;")],
  },
  {
    section: "entity-and-numeric-character-references",
    name: "an entity cannot become an emphasis delimiter",
    markdown: "&#42;foo&#42;\n*foo*",
    content: [p("*foo*\n", text("foo", "italic"))],
  },
  {
    section: "entity-and-numeric-character-references",
    name: "an entity cannot become a list marker",
    markdown: "&#42; foo\n\n&#35; foo",
    content: [p("* foo"), p("# foo")],
  },
  {
    section: "entity-and-numeric-character-references",
    name: "link destinations and titles",
    markdown: '[foo](https://example.org/f&ouml;&ouml; "f&ouml;&ouml;")',
    content: [p(link("foo", "https://example.org/föö", "föö"))],
  },
  {
    section: "entity-and-numeric-character-references",
    name: "reference destinations and titles",
    markdown: '[foo]\n\n[foo]: https://example.org/f&ouml;&ouml; "f&ouml;&ouml;"',
    content: [p(link("foo", "https://example.org/föö", "föö"))],
  },
  {
    section: "entity-and-numeric-character-references",
    name: "fence info string",
    markdown: "``` f&ouml;&ouml;\nfoo\n```",
    content: [code("foo", "föö")],
  },
  {
    section: "entity-and-numeric-character-references",
    name: "code spans are literal",
    markdown: "`f&ouml;&ouml;`",
    content: [p(text("f&ouml;&ouml;", "code"))],
  },
  {
    section: "entity-and-numeric-character-references",
    name: "indented code is literal",
    markdown: "    f&ouml;f&ouml;",
    content: [code("f&ouml;f&ouml;")],
  },
  {
    section: "code-spans",
    name: "ordinary code span",
    markdown: "`foo`",
    content: [p(text("foo", "code"))],
  },
  {
    section: "code-spans",
    name: "longer delimiter contains a backtick",
    markdown: "`` foo ` bar ``",
    content: [p(text("foo ` bar", "code"))],
  },
  {
    section: "code-spans",
    name: "one space removed from each edge",
    markdown: "` `` `",
    content: [p(text("``", "code"))],
  },
  {
    section: "code-spans",
    name: "code span line ending becomes space",
    markdown: "`foo\nbar`",
    content: [p(text("foo bar", "code"))],
  },
  {
    section: "code-spans",
    name: "multiple spaces are retained",
    markdown: "`foo   bar \nbaz`",
    content: [p(text("foo   bar  baz", "code"))],
  },
  {
    section: "code-spans",
    name: "all-space content is retained",
    markdown: "`  `",
    content: [p(text("  ", "code"))],
  },
  {
    section: "code-spans",
    name: "only one edge padded",
    markdown: "` a`",
    content: [p(text(" a", "code"))],
  },
  {
    section: "code-spans",
    name: "backslash does not escape a delimiter",
    markdown: "`foo\\`bar`",
    content: [p(text("foo\\", "code"), "bar`")],
  },
  {
    section: "code-spans",
    name: "backslash is literal in code",
    markdown: "``foo`bar\\``",
    content: [p(text("foo`bar\\", "code"))],
  },
  {
    section: "code-spans",
    name: "unclosed delimiter is literal",
    markdown: "```foo``",
    content: [p("```foo``")],
  },
  {
    section: "code-spans",
    name: "code takes precedence over emphasis",
    markdown: "*foo`*`",
    content: [p("*foo", text("*", "code"))],
  },
  {
    section: "code-spans",
    name: "code takes precedence over links",
    markdown: "[not a `link](/foo`)",
    content: [p("[not a ", text("link](/foo", "code"), ")")],
  },
  {
    section: "code-spans",
    name: "HTML is literal inside code",
    markdown: '`<a href="`">`',
    content: [p(text('<a href="', "code"), '">`')],
  },
  {
    section: "links",
    name: "destination and title",
    markdown: '[link](https://example.org/uri "title")',
    content: [p(link("link", "https://example.org/uri", "title"))],
  },
  {
    section: "links",
    name: "angle destination",
    markdown: '[link](<https://example.org/uri> "title")',
    content: [p(link("link", "https://example.org/uri", "title"))],
  },
  {
    section: "links",
    name: "spaces inside an angle destination",
    markdown: "[link](<https://example.org/foo bar>)",
    content: [p(link("link", "https://example.org/foo bar"))],
  },
  {
    section: "links",
    name: "bare destination cannot contain spaces",
    markdown: "[link](/foo bar)",
    content: [p("[link](/foo bar)")],
  },
  {
    section: "links",
    name: "balanced parentheses",
    markdown: "[link](https://example.org/foo(and(bar)))",
    content: [p(link("link", "https://example.org/foo(and(bar))"))],
  },
  {
    section: "links",
    name: "escaped parentheses",
    markdown: String.raw`[link](https://example.org/foo\(and\(bar\))`,
    content: [p(link("link", "https://example.org/foo(and(bar)"))],
  },
  {
    section: "links",
    name: "backslash before nonpunctuation",
    markdown: String.raw`[link](https://example.org/foo\bar)`,
    content: [p(link("link", "https://example.org/foo\\bar"))],
  },
  {
    section: "links",
    name: "percent encoding is retained",
    markdown: "[link](https://example.org/foo%20b&auml;)",
    content: [p(link("link", "https://example.org/foo%20bä"))],
  },
  {
    section: "links",
    name: "single quoted title",
    markdown: "[link](https://example.org/uri 'title')",
    content: [p(link("link", "https://example.org/uri", "title"))],
  },
  {
    section: "links",
    name: "parenthesized title",
    markdown: "[link](https://example.org/uri (title))",
    content: [p(link("link", "https://example.org/uri", "title"))],
  },
  {
    section: "links",
    name: "escaped quotation marks in a title",
    markdown: String.raw`[link](https://example.org/uri "title \"&quot;")`,
    content: [p(link("link", "https://example.org/uri", 'title ""'))],
  },
  {
    section: "links",
    name: "line break before title",
    markdown: '[link](https://example.org/uri\n"title")',
    content: [p(link("link", "https://example.org/uri", "title"))],
  },
  {
    section: "links",
    name: "line break inside title",
    markdown: '[link](https://example.org/uri "title\nand more")',
    content: [p(link("link", "https://example.org/uri", "title\nand more"))],
  },
  {
    section: "links",
    name: "emphasis inside label",
    markdown: "[link *foo **bar** `#`*](https://example.org/uri)",
    content: [
      p(
        link("link ", "https://example.org/uri"),
        link("foo ", "https://example.org/uri", null, ["italic"]),
        link("bar", "https://example.org/uri", null, ["bold", "italic"]),
        link(" ", "https://example.org/uri", null, ["italic"]),
        link("#", "https://example.org/uri", null, ["italic", "code"]),
      ),
    ],
  },
  {
    section: "links",
    name: "escaped brackets inside label",
    markdown: String.raw`[link\[bar](https://example.org/uri)`,
    content: [p(link("link[bar", "https://example.org/uri"))],
  },
  {
    section: "backslash-escapes",
    name: "escaped backslash before label brackets is unescaped once",
    markdown: String.raw`[foo\\[]](https://example.org/)`,
    content: [p(link("foo\\[]", "https://example.org/"))],
  },
  {
    section: "backslash-escapes",
    name: "reference label brackets are unescaped once",
    markdown: "[foo\\\\[]][ref]\n\n[ref]: https://example.org/",
    content: [p(link("foo\\[]", "https://example.org/"))],
  },
  {
    section: "backslash-escapes",
    name: "autolinks preserve escapes and references",
    markdown: String.raw`<https://example.org/\&copy;>`,
    content: [p(link("https://example.org/\\&copy;", "https://example.org/\\&copy;"))],
  },
  {
    section: "entity-and-numeric-character-references",
    name: "autolinks preserve entities",
    markdown: "<https://example.org/&ouml;>",
    content: [p(link("https://example.org/&ouml;", "https://example.org/&ouml;"))],
  },
  {
    section: "entity-and-numeric-character-references",
    name: "escaped ampersand in fence info string",
    markdown: "~~~ f\\&ouml;\nfoo\n~~~",
    content: [code("foo", "f&ouml;")],
  },
  {
    section: "list-items",
    name: "one through four spaces of padding",
    markdown: "- one\n\n  two",
    content: [list([p("one"), p("two")])],
  },
  {
    section: "list-items",
    name: "four-space marker padding",
    markdown: "-    one\n\n     two",
    content: [list([p("one"), p("two")])],
  },
  {
    section: "list-items",
    name: "five-space padding starts code",
    markdown: "-     one\n\n      two",
    content: [list([p(), code("one\n\ntwo")])],
  },
  {
    section: "list-items",
    name: "indented code following paragraph",
    markdown: "- one\n\n      two",
    content: [list([p("one"), code("two")])],
  },
  {
    section: "list-items",
    name: "lazy continuation",
    markdown: "- one\n two",
    content: [list([p("one\ntwo")])],
  },
  {
    section: "list-items",
    name: "nested list",
    markdown: "- one\n  - two\n    - three",
    content: [list([p("one"), list([p("two"), list([p("three")])])])],
  },
  {
    section: "list-items",
    name: "quote in a list item",
    markdown: "- > one\n  >\n  > two",
    content: [list([p(), quote(p("one"), p("two"))])],
  },
  {
    section: "list-items",
    name: "empty item",
    markdown: "-\n\n- foo",
    content: [list([p()], [p("foo")])],
  },
];

it.each(examples)("CommonMark 0.31.2 $section: $name", ({ markdown, content }) => {
  const imported = importMarkdown(markdown, "commonmark.md");
  expect(imported.json).toEqual(schema.nodeFromJSON({ type: "doc", content }).toJSON());
});

it.each([
  ..."!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~",
  "«",
  "φ",
])("applies CommonMark's ASCII punctuation escape rule in every string context: %j", (punctuation) => {
  const raw = `\\${punctuation}&copy;`;
  const expected = `${punctuation === "«" || punctuation === "φ" ? "\\" : ""}${punctuation}©`;
  const href = `https://example.org/${expected}`;
  const imported = importMarkdown(
    `${raw}\n\n[${raw}](https://example.org/${raw} "${raw}")\n\n[${raw}][ref]\n\n[ref]: https://example.org/${raw} "${raw}"\n\n![${raw}](https://example.org/${raw} "${raw}")\n\n~~~ ${raw}\n${raw}\n~~~`,
    "punctuation.md",
  );
  expect(imported.skipped).toEqual([]);
  expect(imported.json).toEqual(
    schema
      .nodeFromJSON({
        type: "doc",
        content: [
          p(expected),
          p(link(expected, href, expected)),
          p(link(expected, href, expected)),
          image(expected, href, expected),
          code(raw, expected),
        ],
      })
      .toJSON(),
  );
  const language = { type: "doc", content: [code(raw, expected)] };
  expect(importMarkdown(exportMarkdown(language), "language.md").json).toEqual(
    schema.nodeFromJSON(language).toJSON(),
  );
});

it("decodes escapes and references once from source in prose, labels, destinations, titles and alt", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 8 }),
      fc.constantFrom("&copy;", "&#169;", "&#xA9;"),
      (slashes, reference) => {
        const raw = "\\".repeat(slashes) + reference;
        const expected = "\\".repeat(Math.floor(slashes / 2)) + (slashes % 2 ? reference : "©");
        const href = `https://example.org/${expected}`;
        const imported = importMarkdown(
          `${raw}\n\n[${raw}](https://example.org/${raw} "${raw}")\n\n[${raw}][ref]\n\n[ref]: https://example.org/${raw} "${raw}"\n\n![${raw}](https://example.org/${raw} "${raw}")\n\n\`${raw}\`\n\n~~~\n${raw}\n~~~\n\n    ${raw}`,
          "escapes.md",
        );
        expect(imported.skipped).toEqual([]);
        expect(imported.json).toEqual(
          schema
            .nodeFromJSON({
              type: "doc",
              content: [
                p(expected),
                p(link(expected, href, expected)),
                p(link(expected, href, expected)),
                image(expected, href, expected),
                p(text(raw, "code")),
                code(raw),
                code(raw),
              ],
            })
            .toJSON(),
        );
        expect(importMarkdown(exportMarkdown(imported.json), "exported.md").json).toEqual(
          imported.json,
        );
      },
    ),
    { seed: 2807, numRuns: 100 },
  );
});
